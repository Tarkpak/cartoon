use super::*;

const INSTANCE: &str =
    "COALESCE(json_extract(record_json,'$.providerInstanceId'), provider || ':legacy')";
const MODEL: &str =
    "COALESCE(json_extract(record_json,'$.usage.model'),json_extract(record_json,'$.model'),'')";
const STAGE: &str = "COALESCE(json_extract(record_json,'$.stage'),json_extract(record_json,'$.operation'),'unknown')";
const TOTALS: &str =
    "COUNT(*), COALESCE(SUM(json_extract(record_json,'$.usage.usageStatus') != 'reported'),0),
 COUNT(COALESCE(json_extract(record_json,'$.usage.costNanoUsd'),json_extract(record_json,'$.usage.costNanoCny'))),
 COALESCE(SUM(json_extract(record_json,'$.usage.inputTokens')),0),
 COALESCE(SUM(json_extract(record_json,'$.usage.outputTokens')),0),
 COALESCE(SUM(json_extract(record_json,'$.usage.costNanoUsd')),0),
 COALESCE(SUM(json_extract(record_json,'$.usage.costNanoCny')),0),
 COUNT(json_extract(record_json,'$.usage.costNanoUsd')),COUNT(json_extract(record_json,'$.usage.costNanoCny'))";

struct Filter {
    sql: String,
    binds: Vec<String>,
    page: i64,
    size: i64,
}

fn bad(message: &str) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, message)
}

fn date_bound(raw: &str, next: bool) -> Result<String, ApiError> {
    let mut date = chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|_| bad("日期需为 YYYY-MM-DD"))?;
    if date.format("%Y-%m-%d").to_string() != raw {
        return Err(bad("日期无效"));
    }
    if next {
        date = date.succ_opt().ok_or_else(|| bad("日期超出范围"))?;
    }
    let utc = date.and_hms_opt(0, 0, 0).unwrap() - chrono::Duration::hours(8);
    Ok(utc.format("%Y-%m-%dT%H:%M:%SZ").to_string())
}

fn filter(owner: &str, query: &HashMap<String, String>) -> Result<Filter, ApiError> {
    let mut sql = "owner_user_id = ?".to_string();
    let mut binds = vec![owner.to_string()];
    if let Some(currency)=query.get("currency").filter(|v|!v.is_empty()) {
        if !matches!(currency.as_str(),"USD"|"CNY") { return Err(bad("币种无效")); }
        sql.push_str(" AND COALESCE(json_extract(record_json,'$.usage.currency'),'USD')=?");
        binds.push(currency.clone());
    }
    for (key, expression) in [
        ("requestId", "request_id"),
        ("projectId", "COALESCE(project_id,'')"),
        ("taskId", "task_id"),
        ("id", "id"),
        ("providerInstanceId", INSTANCE),
        ("model", MODEL),
        ("stage", STAGE),
    ] {
        if let Some(value) = query.get(key).filter(|v| !v.is_empty()) {
            if value.len() > 512 {
                return Err(bad("筛选值过长"));
            }
            sql.push_str(&format!(" AND {expression} = ?"));
            binds.push(if key == "projectId" && value == "__unassigned__" {
                String::new()
            } else {
                value.clone()
            });
        }
    }
    for (key, next, op) in [("startDate", false, ">="), ("endDate", true, "<")] {
        if let Some(value) = query.get(key).filter(|v| !v.is_empty()) {
            sql.push_str(&format!(" AND julianday(created_at) {op} julianday(?)"));
            binds.push(date_bound(value, next)?);
        }
    }
    if let (Some(start), Some(end)) = (
        query.get("startDate").filter(|v| !v.is_empty()),
        query.get("endDate").filter(|v| !v.is_empty()),
    ) {
        if start > end {
            return Err(bad("开始日期不能晚于结束日期"));
        }
    }
    let page = query
        .get("page")
        .map(|v| v.parse::<i64>())
        .transpose()
        .map_err(|_| bad("页码无效"))?
        .unwrap_or(1);
    let size = query
        .get("pageSize")
        .map(|v| v.parse::<i64>())
        .transpose()
        .map_err(|_| bad("每页数量无效"))?
        .unwrap_or(50);
    if !(1..=1_000_000).contains(&page) || !(1..=100).contains(&size) {
        return Err(bad("分页参数超出范围"));
    }
    Ok(Filter {
        sql,
        binds,
        page,
        size,
    })
}

fn totals(row: &rusqlite::Row<'_>, offset: usize) -> rusqlite::Result<Value> {
    let calls = row.get::<_, i64>(offset)?;
    let unknown = row.get::<_, i64>(offset + 1)?;
    let priced = row.get::<_, i64>(offset + 2)?;
    let cost = row.get::<_, i64>(offset + 5)?;
    let cny = row.get::<_, i64>(offset + 6)?;
    let usd_calls = row.get::<_, i64>(offset + 7)?;
    let cny_calls = row.get::<_, i64>(offset + 8)?;
    Ok(
        json!({"calls":calls,"unknownCalls":unknown,"pricedCalls":priced,"inputTokens":row.get::<_,i64>(offset+3)?,"outputTokens":row.get::<_,i64>(offset+4)?,"costNanoUsd":cost,
        "costNanoCny":cny,"pricedUsdCalls":usd_calls,"pricedCnyCalls":cny_calls,
        "averageCostNanoUsd":if usd_calls>0 {Some(cost/usd_calls)}else{None},"averageCostNanoCny":if cny_calls>0 {Some(cny/cny_calls)}else{None},"coverage":if calls>0 {priced as f64/calls as f64}else{0.0}}),
    )
}

fn summary(conn: &Connection, f: &Filter, extra: &str) -> Result<Value, ApiError> {
    conn.query_row(
        &format!(
            "SELECT {TOTALS} FROM model_usage_records WHERE {} {extra}",
            f.sql
        ),
        rusqlite::params_from_iter(f.binds.iter()),
        |row| totals(row, 0),
    )
    .map_err(db_error)
}

fn groups(
    conn: &Connection,
    f: &Filter,
    expression: &str,
    names: &HashMap<String, String>,
    kind: &str,
) -> Result<Vec<Value>, ApiError> {
    let mut stmt=conn.prepare(&format!("SELECT {expression} AS group_key,{TOTALS} FROM model_usage_records WHERE {} GROUP BY group_key ORDER BY 7 DESC,8 DESC,group_key",f.sql)).map_err(db_error)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(f.binds.iter()), |row| {
            Ok((row.get::<_, String>(0)?, totals(row, 1)?))
        })
        .map_err(db_error)?;
    let mut output = Vec::new();
    for row in rows {
        let (key, mut value) = row.map_err(db_error)?;
        let label = if kind == "project" {
            names.get(&key).cloned().unwrap_or_else(|| {
                if key.is_empty() {
                    "未关联项目".into()
                } else {
                    key.clone()
                }
            })
        } else if kind == "provider" {
            names.get(&key).cloned().unwrap_or_else(|| key.clone())
        } else {
            key.clone()
        };
        value["key"] = json!(if kind == "project" && key.is_empty() {
            "__unassigned__"
        } else {
            &key
        });
        value["label"] = json!(label);
        output.push(value);
    }
    Ok(output)
}

fn project_names(conn: &Connection, owner: &str) -> HashMap<String, String> {
    let mut names = HashMap::new();
    for sql in ["SELECT id,name FROM projects WHERE owner_user_id=?1",
        "SELECT json_extract(record_json,'$.providerInstanceId'),json_extract(record_json,'$.providerInstanceName') FROM model_usage_records WHERE owner_user_id=?1 AND json_extract(record_json,'$.providerInstanceName') IS NOT NULL ORDER BY created_at"] {
        if let Ok(mut stmt)=conn.prepare(sql) {
            if let Ok(rows)=stmt.query_map(params![owner],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))){names.extend(rows.filter_map(Result::ok));}
        }
    }
    names
}

pub(super) fn query_data(
    conn: &Connection,
    owner: &str,
    query: &HashMap<String, String>,
) -> Result<Value, ApiError> {
    let transaction = conn.unchecked_transaction().map_err(db_error)?;
    let conn = &transaction;
    let f = filter(owner, query)?;
    let names = project_names(conn, owner);
    let total = summary(conn, &f, "")?;
    let today = summary(
        conn,
        &f,
        "AND date(created_at,'+8 hours')=date('now','+8 hours')",
    )?;
    let month = summary(
        conn,
        &f,
        "AND strftime('%Y-%m',created_at,'+8 hours')=strftime('%Y-%m','now','+8 hours')",
    )?;
    let mut stmt=conn.prepare(&format!("SELECT record_json FROM model_usage_records WHERE {} ORDER BY julianday(created_at) DESC,id DESC LIMIT {} OFFSET {}",f.sql,f.size,(f.page-1)*f.size)).map_err(db_error)?;
    let records = stmt
        .query_map(rusqlite::params_from_iter(f.binds.iter()), |r| {
            r.get::<_, String>(0)
        })
        .map_err(db_error)?
        .map(|r| {
            r.map_err(db_error).and_then(|s| {
                serde_json::from_str::<Value>(&s).map_err(|_| bad("用量记录格式无效"))
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let projects = groups(conn, &f, "COALESCE(project_id,'')", &names, "project")?;
    let stages = groups(conn, &f, STAGE, &names, "stage")?;
    let models = groups(
        conn,
        &f,
        &format!("json_array({INSTANCE},{MODEL},{STAGE})"),
        &names,
        "model",
    )?;
    let all = filter(owner, &HashMap::new())?;
    let options = json!({"projects":groups(conn,&all,"COALESCE(project_id,'')",&names,"project")?,"providers":groups(conn,&all,INSTANCE,&names,"provider")?,"models":groups(conn,&all,MODEL,&names,"model")?,"stages":groups(conn,&all,STAGE,&names,"stage")?});
    let calls = total["calls"].as_i64().unwrap_or(0);
    Ok(
        json!({"total":total,"today":today,"month":month,"records":records,"projects":projects,"stages":stages,"models":models,"options":options,"page":f.page,"pageSize":f.size,"totalPages":((calls+f.size-1)/f.size).max(1),"timezone":"Asia/Shanghai"}),
    )
}

pub(crate) async fn get(
    State(state): State<BackendState>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let owner = current_project_owner_context(&conn)?;
    Ok(Json(
        json!({"success":true,"data":query_data(&conn,&owner.user_id,&query)?}),
    ))
}

fn csv_cell(value: &str) -> String {
    let trimmed = value.trim_start_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    let prefix =
        if trimmed.starts_with(['=', '+', '-', '@']) || value.starts_with(['\t', '\r', '\n']) {
            "'"
        } else {
            ""
        };
    format!("\"{}{}\"", prefix, value.replace('"', "\"\""))
}

pub(super) fn csv(
    conn: &Connection,
    owner: &str,
    query: &HashMap<String, String>,
) -> Result<String, ApiError> {
    let f = filter(owner, query)?;
    let mut output="\u{feff}调用ID,时间UTC,项目ID,供应商实例,模型,环节,状态,输入Token,输出Token,缓存Token,推理Token,文字输入Token,图片输入Token,用量状态,预估费用USD,预估费用CNY,币种,价格版本,计费单位,输入图片张数,输出图片张数,输入视频秒数,输出视频秒数,语音字符数\r\n".to_string();
    let mut stmt=conn.prepare(&format!("SELECT record_json FROM model_usage_records WHERE {} ORDER BY julianday(created_at) DESC,id DESC",f.sql)).map_err(db_error)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(f.binds.iter()), |r| {
            r.get::<_, String>(0)
        })
        .map_err(db_error)?;
    for row in rows {
        let record: Value =
            serde_json::from_str(&row.map_err(db_error)?).map_err(|_| bad("用量记录格式无效"))?;
        let mut values = vec![
            record["id"].clone(),
            record["createdAt"].clone(),
            record["projectId"].clone(),
            record["providerInstanceId"]
                .as_str()
                .map(|id| json!(id))
                .unwrap_or_else(|| {
                    json!(format!(
                        "{}:legacy",
                        record["provider"].as_str().unwrap_or("unknown")
                    ))
                }),
            record["usage"]["model"]
                .as_str()
                .map(|v| json!(v))
                .unwrap_or(record["model"].clone()),
            record["stage"]
                .as_str()
                .map(|v| json!(v))
                .unwrap_or(record["operation"].clone()),
            record["status"].clone(),
        ];
        for key in [
            "inputTokens",
            "outputTokens",
            "cachedTokens",
            "reasoningTokens",
            "textInputTokens",
            "imageInputTokens",
            "usageStatus",
        ] {
            values.push(record["usage"][key].clone());
        }
        values.push(
            record["usage"]["costNanoUsd"]
                .as_i64()
                .map(|v| json!(format!("{}.{:09}", v / 1_000_000_000, v % 1_000_000_000)))
                .unwrap_or(Value::Null),
        );
        values.push(record["usage"]["costNanoCny"].as_i64().map(|v|json!(format!("{}.{:09}",v/1_000_000_000,v%1_000_000_000))).unwrap_or(Value::Null));
        values.push(record["usage"]["currency"].clone());
        values.push(record["usage"]["priceSnapshot"]["version"].clone());
        for key in ["billingUnit", "inputImages", "outputImages", "inputVideoSeconds", "durationSeconds", "characters"] {
            values.push(record["usage"][key].clone());
        }
        output.push_str(
            &values
                .iter()
                .map(|v| {
                    csv_cell(&if v.is_null() {
                        String::new()
                    } else {
                        v.as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| v.to_string())
                    })
                })
                .collect::<Vec<_>>()
                .join(","),
        );
        output.push_str("\r\n");
    }
    Ok(output)
}

pub(crate) async fn export(
    State(state): State<BackendState>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    let conn = db_connection(&state)?;
    let owner = current_project_owner_context(&conn)?;
    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=model-usage.csv",
            ),
        ],
        csv(&conn, &owner.user_id, &query)?,
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filters_pages_and_export_share_scope() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        for (id, owner, date, cost) in [
            ("1", "a", "2026-11-04T15:59:59Z", Some(10)),
            ("2", "a", "2026-11-04T16:00:00Z", Some(20)),
            ("3", "a", "2026-11-05T15:59:59Z", None),
            ("4", "a", "2026-11-05T16:00:00Z", Some(40)),
            ("5", "b", "2026-11-05T10:00:00Z", Some(999)),
        ] {
            save(&conn,&json!({"id":id,"provider":"openai","model":"=formula","createdAt":date,"projectId":"p","operation":"generateText","usage":{"usageStatus":"reported","costNanoUsd":cost,"inputTokens":1,"outputTokens":2}}),Some(owner)).unwrap();
        }
        let query = HashMap::from([
            ("startDate".into(), "2026-11-05".into()),
            ("endDate".into(), "2026-11-05".into()),
            ("pageSize".into(), "1".into()),
            ("projectId".into(), "p".into()),
        ]);
        let data = query_data(&conn, "a", &query).unwrap();
        assert_eq!(data["total"]["calls"], 2);
        assert_eq!(data["total"]["costNanoUsd"], 20);
        assert_eq!(data["total"]["averageCostNanoUsd"], 20);
        assert_eq!(data["records"].as_array().unwrap().len(), 1);
        assert_eq!(data["totalPages"], 2);
        assert_eq!(data["projects"][0]["costNanoUsd"], 20);
        let text = csv(&conn, "a", &query).unwrap();
        assert_eq!(text.lines().count(), 3);
        assert!(text.contains("'=formula"));
        assert!(!text.contains("0.000000999"));
        assert!(filter(
            "a",
            &HashMap::from([("startDate".into(), "2026-02-30".into())])
        )
        .is_err());
        assert!(filter("a", &HashMap::from([("page".into(), "0".into())])).is_err());
        assert_eq!(csv_cell(" a,\"b\"\nc"), "\" a,\"\"b\"\"\nc\"");
    }
}
