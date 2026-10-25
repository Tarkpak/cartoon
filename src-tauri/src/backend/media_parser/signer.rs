//! Upstream signing scripts executed in embedded QuickJS (replaces mini-racer/V8).

use super::core::{random_string, UrlParts};
use rquickjs::{context::EvalOptions, Context, Function, Runtime};

pub const BYTEDANCE_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

fn sloppy() -> EvalOptions {
    let mut options = EvalOptions::default();
    // Upstream scripts assign implicit globals and need non-strict evaluation.
    options.strict = false;
    options
}

struct Script {
    // The runtime must outlive the context; keep both together.
    context: Context,
    _runtime: Runtime,
}

impl Script {
    fn load(sources: &[&str]) -> Option<Script> {
        let runtime = Runtime::new().ok()?;
        runtime.set_memory_limit(256 * 1024 * 1024);
        let context = Context::full(&runtime).ok()?;
        let loaded = context.with(|ctx| {
            sources
                .iter()
                .all(|source| ctx.eval_with_options::<(), _>(*source, sloppy()).is_ok())
        });
        loaded.then_some(Script {
            context,
            _runtime: runtime,
        })
    }

    fn call(&self, name: &str, args: &[&str]) -> Option<String> {
        self.context.with(|ctx| {
            let function: Function = ctx.globals().get(name).ok()?;
            let result: rquickjs::Result<String> = match args {
                [] => function.call(()),
                [a] => function.call((*a,)),
                [a, b] => function.call((*a, *b)),
                _ => return None,
            };
            result.ok()
        })
    }
}

/// ByteDance a_bogus / msToken (upstream X-Bogus is never called by a parser).
pub struct BogusSigner {
    a_bogus: Option<Script>,
}

impl BogusSigner {
    pub fn new() -> BogusSigner {
        BogusSigner { a_bogus: None }
    }

    pub fn user_agent(&self) -> &'static str {
        BYTEDANCE_UA
    }

    pub fn a_bogus(&mut self, url: &str, user_agent: &str) -> Option<String> {
        if self.a_bogus.is_none() {
            self.a_bogus = Script::load(&[include_str!("assets/a_bogus.js")]);
        }
        let query = UrlParts::parse(url).query;
        self.a_bogus.as_ref()?.call("generate_a_bogus", &[&query, user_agent])
    }

    pub fn ms_token(length: usize) -> String {
        // Upstream alphabet keeps its duplicated "G"/"g" in place of "J"/"j".
        random_string(
            "ABCDEFGHIGKLMNOPQRSTUVWXYZabcdefghigklmnopqrstuvwxyz0123456789=",
            length,
        )
    }
}

/// Pinduoduo `anti-content`.
pub fn pinduoduo_anti_content() -> String {
    Script::load(&[
        include_str!("assets/pdd_env.js"),
        include_str!("assets/anti_content.js"),
        include_str!("assets/pdd_init.js"),
    ])
    .and_then(|script| script.call("getAntiContent", &[]))
    .unwrap_or_default()
}

/// Evaluate `sources` then each expression; `None` when any step throws.
pub fn eval_expressions(sources: &[&str], expressions: &[&str]) -> Option<Vec<Option<String>>> {
    let script = Script::load(sources)?;
    script.context.with(|ctx| {
        expressions
            .iter()
            .map(|expr| {
                let wrapped = format!(
                    "(function(){{ var v = ({expr}); return v === undefined || v === null ? null : String(v); }})()"
                );
                ctx.eval_with_options::<Option<String>, _>(wrapped, sloppy()).ok()
            })
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_upstream_signing_scripts() {
        let mut signer = BogusSigner::new();
        let url = "https://www.douyin.com/aweme/v1/web/aweme/detail/?aid=6383&aweme_id=1&msToken=x";
        assert!(signer.a_bogus(url, BYTEDANCE_UA).is_some_and(|v| v.len() > 40));
        assert_eq!(BogusSigner::ms_token(107).len(), 107);
        assert!(pinduoduo_anti_content().len() > 40);
        let values = eval_expressions(&["var r = {token: 'abc'}; var c = '';"], &["r.token", "c", "r.missing"]).unwrap();
        assert_eq!(values, vec![Some("abc".into()), Some(String::new()), None]);
        assert!(eval_expressions(&["var a = 1;"], &["undefinedName.x"]).is_none());
    }
}
