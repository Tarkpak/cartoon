use super::*;

// Optional UI progress sink. Upstream text streaming also works outside this scope.
tokio::task_local! {
    pub(super) static TEXT_STREAM_PROGRESS: tokio::sync::watch::Sender<Value>;
}

pub(super) fn text_stream_connecting() {
    let _ = TEXT_STREAM_PROGRESS.try_with(|sender| {
        sender.send_replace(json!({
            "type": "progress", "payload": {
                "step": "generating", "streamState": "connecting", "outputChars": 0,
                "message": "正在连接模型，准备生成结果"
            }
        }))
    });
}

#[derive(Default)]
struct SseDecoder {
    pending: String,
    seen: bool,
    done: bool,
}

impl SseDecoder {
    fn consume_line(&mut self, line: &[u8]) -> Result<Option<Value>, String> {
        let line = std::str::from_utf8(line).map_err(|error| error.to_string())?;
        let Some(data) = line.trim().strip_prefix("data:") else {
            if line.trim().is_empty() && !self.pending.is_empty() {
                return Err("模型流式事件 JSON 不完整".into());
            }
            return Ok(None);
        };
        self.seen = true;
        if data.trim() == "[DONE]" {
            if !self.pending.is_empty() {
                return Err("模型流式事件 JSON 不完整".into());
            }
            self.done = true;
            return Ok(None);
        }
        if !self.pending.is_empty() {
            self.pending.push('\n');
        }
        self.pending.push_str(data.trim_start());
        match serde_json::from_str::<Value>(&self.pending) {
            Ok(payload) => {
                self.pending.clear();
                Ok(Some(payload))
            }
            Err(error) if error.is_eof() => Ok(None),
            Err(error) => Err(format!("模型流式事件 JSON 无效：{error}")),
        }
    }

    fn finish(&self) -> Result<(), String> {
        if self.pending.is_empty() {
            Ok(())
        } else {
            Err("模型流式事件 JSON 不完整".into())
        }
    }
}

#[derive(Default)]
struct TextStreamFeedback {
    decoder: SseDecoder,
    terminal: bool,
    output_chars: usize,
    thinking: bool,
    failure: Option<String>,
}

impl TextStreamFeedback {
    fn consume_line(&mut self, line: &[u8]) -> Result<(), String> {
        let Some(payload) = self.decoder.consume_line(line)? else {
            return Ok(());
        };
        let finish_reason = payload
            .pointer("/choices/0/finish_reason")
            .or_else(|| payload.pointer("/candidates/0/finishReason"))
            .and_then(Value::as_str)
            .filter(|reason| !reason.is_empty());
        if let Some(reason) = finish_reason {
            if ["length", "max_tokens", "content_filter", "safety"]
                .iter()
                .any(|value| reason.eq_ignore_ascii_case(value))
            {
                self.failure = Some(format!(
                    "模型生成未完整结束（finish_reason={reason}），请重试"
                ));
            }
            self.terminal = true;
        }
        if let Some(error) = payload.get("error") {
            return Err(format!(
                "模型流式响应错误: {}",
                error.get("message").unwrap_or(error)
            ));
        }
        if let Some(delta) = payload.pointer("/choices/0/delta") {
            if let Some(text) = delta.get("content").and_then(Value::as_str) {
                self.output_chars += text.chars().count();
            }
            self.thinking |= delta
                .get("reasoning_content")
                .and_then(Value::as_str)
                .is_some_and(|text| !text.is_empty());
        }
        if let Some(parts) = payload
            .pointer("/candidates/0/content/parts")
            .and_then(Value::as_array)
        {
            for part in parts {
                if part.get("thought").and_then(Value::as_bool) == Some(true) {
                    self.thinking = true;
                } else if let Some(text) = part.get("text").and_then(Value::as_str) {
                    self.output_chars += text.chars().count();
                }
            }
        }
        Ok(())
    }

    fn finish(&self) -> Result<(), String> {
        self.decoder.finish()?;
        if let Some(error) = &self.failure { return Err(error.clone()); }
        if self.decoder.seen && !self.decoder.done && !self.terminal {
            return Err("模型流提前结束，未收到完成标记，请重试".into());
        }
        Ok(())
    }

    fn message(&self) -> String {
        if self.output_chars > 0 {
            format!("模型正在生成解析结果，已接收 {} 字", self.output_chars)
        } else if self.thinking {
            "模型正在思考，等待生成解析结果".to_string()
        } else {
            "已连接模型，等待生成解析结果".to_string()
        }
    }
}

pub(super) async fn read_text_model_response(
    response: reqwest::Response,
) -> Result<String, String> {
    read_text_model_response_captured(response, &mut Vec::new()).await
}

pub(super) async fn read_text_model_response_captured(
    mut response: reqwest::Response,
    raw: &mut Vec<u8>,
) -> Result<String, String> {
    if !response.status().is_success() {
        return response
            .text()
            .await
            .map_err(|error| build_llm_transport_error_message(&error));
    }
    let mut line_start = 0;
    let mut feedback = TextStreamFeedback::default();
    let mut last_feedback = std::time::Instant::now() - Duration::from_secs(1);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| build_llm_transport_error_message(&error))?
    {
        raw.extend_from_slice(&chunk);
        // Split on bytes so UTF-8 characters spanning network chunks remain intact.
        while let Some(end) = raw[line_start..].iter().position(|byte| *byte == b'\n') {
            let end = line_start + end;
            feedback.consume_line(&raw[line_start..end])?;
            line_start = end + 1;
        }
        if last_feedback.elapsed() >= Duration::from_millis(500) {
            let _ = TEXT_STREAM_PROGRESS.try_with(|sender| {
                sender.send_replace(json!({
                    "type": "progress", "payload": {
                        "step": "generating", "message": feedback.message(),
                        "outputChars": feedback.output_chars,
                        "streamState": if feedback.output_chars > 0 { "receiving" }
                            else if feedback.thinking { "thinking" } else { "waiting" }
                    }
                }))
            });
            last_feedback = std::time::Instant::now();
        }
    }
    feedback.consume_line(&raw[line_start..])?;
    feedback.finish()?;
    String::from_utf8(raw.clone()).map_err(|error| error.to_string())
}

pub(super) fn parse_gemini_completion_response(raw: &str) -> Result<Value, serde_json::Error> {
    if !raw
        .lines()
        .any(|line| line.trim_start().starts_with("data:"))
    {
        return serde_json::from_str(raw);
    }
    let mut parts = Vec::new();
    let mut finish_reason = Value::Null;
    let mut decoder = SseDecoder::default();
    for line in raw.lines() {
        let payload = decoder.consume_line(line.as_bytes()).map_err(|error| {
            serde_json::Error::io(std::io::Error::new(std::io::ErrorKind::InvalidData, error))
        })?;
        let Some(payload) = payload else {
            continue;
        };
        if let Some(items) = payload
            .pointer("/candidates/0/content/parts")
            .and_then(Value::as_array)
        {
            parts.extend(
                items
                    .iter()
                    .filter(|part| part.get("thought").and_then(Value::as_bool) != Some(true))
                    .cloned(),
            );
        }
        if let Some(reason) = payload.pointer("/candidates/0/finishReason") {
            finish_reason = reason.clone();
        }
    }
    decoder.finish().map_err(|error| {
        serde_json::Error::io(std::io::Error::new(std::io::ErrorKind::InvalidData, error))
    })?;
    let text: String = parts
        .iter()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect();
    Ok(
        json!({ "candidates": [{ "content": { "parts": [{"text": text}] }, "finishReason": finish_reason }] }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn preserves_final_usage_after_truncation() {
        let bytes = b"data: {\"choices\":[{\"finish_reason\":\"length\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":34}}\n\ndata: [DONE]\n\n";
        let response = reqwest::Response::from(axum::http::Response::new(reqwest::Body::from(bytes.to_vec())));
        let mut raw=Vec::new();
        assert!(read_text_model_response_captured(response,&mut raw).await.is_err());
        assert!(String::from_utf8(raw).unwrap().contains("completion_tokens"));
    }

    #[tokio::test]
    async fn reports_partial_output_before_completion_and_preserves_utf8() {
        use futures_util::StreamExt;
        let first = "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\n".as_bytes();
        let split = first.iter().position(|byte| *byte == 0xe4).unwrap() + 1;
        let (release, wait) = tokio::sync::oneshot::channel::<()>();
        let chunks = stream::iter(vec![
            Ok::<_, std::io::Error>(Bytes::copy_from_slice(&first[..split])),
            Ok(Bytes::copy_from_slice(&first[split..])),
        ])
        .chain(stream::once(async move {
            wait.await.unwrap();
            Ok(Bytes::from_static(b"data: [DONE]\n\n"))
        }));
        let response = reqwest::Response::from(axum::http::Response::new(
            reqwest::Body::wrap_stream(chunks),
        ));
        let (sender, mut receiver) = tokio::sync::watch::channel(Value::Null);
        let result = TEXT_STREAM_PROGRESS
            .scope(sender, async {
                let read = read_text_model_response(response);
                tokio::pin!(read);
                tokio::select! {
                    result = &mut read => panic!("response completed before release: {result:?}"),
                    _ = receiver.changed() => {}
                }
                assert!(receiver.borrow_and_update()["payload"]["message"]
                    .as_str()
                    .unwrap()
                    .contains("模型"));
                release.send(()).unwrap();
                read.await.unwrap()
            })
            .await;
        assert_eq!(
            parse_openai_compatible_text_response(&result)
                .unwrap()
                .as_deref(),
            Some("你好")
        );
    }

    #[tokio::test]
    async fn validates_stream_without_progress_subscriber_and_accepts_json_fallback() {
        for (raw, success) in [
            ("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n", false),
            ("data: {\"choices\":[{\"delta\":{\"content\":\"done\"},\"finish_reason\":\"stop\"}]}\n\n", true),
            ("{\"choices\":[{\"message\":{\"content\":\"done\"}}]}", true),
            ("data: {\"choices\":[{\"delta\":{\"content\":\"cut off\"},\"finish_reason\":\"length\"}]}\n\n", false),
        ] {
            let response = reqwest::Response::from(axum::http::Response::new(reqwest::Body::from(raw)));
            let result = read_text_model_response(response).await;
            assert_eq!(result.is_ok(), success, "{result:?}");
        }
    }

    #[tokio::test]
    async fn preserves_error_body_and_reports_interrupted_transport_without_progress() {
        let response = reqwest::Response::from(
            axum::http::Response::builder()
                .status(429)
                .body(reqwest::Body::from(r#"{"error":{"message":"rate limited"}}"#))
                .unwrap(),
        );
        assert_eq!(
            read_text_model_response(response).await.unwrap(),
            r#"{"error":{"message":"rate limited"}}"#
        );
        let chunks = stream::iter(vec![
            Ok(Bytes::from_static(b"data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n")),
            Err(std::io::Error::new(std::io::ErrorKind::ConnectionReset, "connection reset")),
        ]);
        let response = reqwest::Response::from(axum::http::Response::new(
            reqwest::Body::wrap_stream(chunks),
        ));
        let error = read_text_model_response(response).await.unwrap_err();
        assert!(error.contains("connection reset"), "{error}");
    }

    #[test]
    fn accepts_multiline_events_and_rejects_malformed_data() {
        let raw = "data: {\"candidates\":[{\n data: \"content\":{\"parts\":[{\"text\":\"你好\"}]},\"finishReason\":\"STOP\"}]}\n\n";
        let payload = parse_gemini_completion_response(raw).unwrap();
        assert_eq!(parse_gemini_text_result(&payload).as_deref(), Some("你好"));
        let mut feedback = TextStreamFeedback::default();
        for line in raw.lines() {
            feedback.consume_line(line.as_bytes()).unwrap();
        }
        assert!(feedback.finish().is_ok());
        assert_eq!(feedback.output_chars, 2);
        assert!(TextStreamFeedback::default()
            .consume_line(b"data: broken")
            .is_err());
    }

    #[test]
    fn streaming_result_keeps_whitespace_and_excludes_reasoning() {
        let raw = concat!(
            "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"private reasoning\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\" \"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"world\"},\"finish_reason\":\"length\"}]}\n\n",
        );
        assert_eq!(
            parse_openai_compatible_text_response(raw)
                .unwrap()
                .as_deref(),
            Some("hello world")
        );
        assert_eq!(
            parse_openai_compatible_truncation_reason(raw).as_deref(),
            Some("length")
        );
    }

    #[test]
    fn feedback_counts_output_without_exposing_reasoning() {
        let mut feedback = TextStreamFeedback::default();
        feedback
            .consume_line(br#"data: {"choices":[{"delta":{"reasoning_content":"private"}}]}"#)
            .unwrap();
        assert!(feedback.message().contains("思考"));
        feedback
            .consume_line("data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}".as_bytes())
            .unwrap();
        assert_eq!(feedback.output_chars, 2);
        assert!(!feedback.message().contains("private"));
        assert!(feedback
            .consume_line(br#"data: {"error":{"message":"disconnected"}}"#)
            .is_err());
    }

    #[test]
    fn gemini_merges_stream_and_preserves_truncation() {
        let raw = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"secret\",\"thought\":true},{\"text\":\"hello\"}]}}]}\n\ndata: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"world\"}]},\"finishReason\":\"MAX_TOKENS\"}]}\n\n";
        let payload = parse_gemini_completion_response(raw).unwrap();
        assert_eq!(parse_gemini_text_result(&payload).unwrap(), "helloworld");
        assert_eq!(payload["candidates"][0]["finishReason"], "MAX_TOKENS");
        assert!(parse_gemini_completion_response("data: broken").is_err());
    }
}
