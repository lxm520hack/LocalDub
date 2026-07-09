use fnrpc::error::RpcErr;
use fnrpc::handler::RpcFn;
use fnrpc::router::RpcRouter;
use serde::{Deserialize, Serialize};
use specta::Type;

// --- Test types ---

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
struct GreetInput {
    name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
struct GreetOutput {
    message: String,
}

// --- Manual RpcFn impl ---

struct Greet;

#[async_trait::async_trait]
impl RpcFn<()> for Greet {
    type Input = GreetInput;
    type Output = GreetOutput;
    const NAME: &'static str = "greet";

    async fn exec(_ctx: &(), input: Self::Input) -> Result<Self::Output, RpcErr> {
        Ok(GreetOutput {
            message: format!("hello {}", input.name),
        })
    }
}

// --- Function with context ---

struct AppCtx {
    prefix: String,
}

struct CtxGreet;

#[async_trait::async_trait]
impl RpcFn<AppCtx> for CtxGreet {
    type Input = GreetInput;
    type Output = GreetOutput;
    const NAME: &'static str = "ctx_greet";

    async fn exec(ctx: &AppCtx, input: Self::Input) -> Result<Self::Output, RpcErr> {
        Ok(GreetOutput {
            message: format!("{}{}", ctx.prefix, input.name),
        })
    }
}

// --- #[rpc_fn] macro test ---

#[fnrpc::rpc_fn]
async fn macro_greet(input: GreetInput) -> Result<GreetOutput, String> {
    Ok(GreetOutput {
        message: format!("macro hello {}", input.name),
    })
}

#[tokio::test]
async fn test_manual_rpc() {
    let mut router = RpcRouter::<()>::new();
    router.add(Greet);

    let input = serde_json::json!({ "name": "world" });

    // Dispatch
    let result = router.dispatch(&(), "greet", input).await.unwrap();
    let output: GreetOutput = serde_json::from_value(result).unwrap();
    assert_eq!(output.message, "hello world");

    // Unknown method
    let err = router.dispatch(&(), "nonexistent", serde_json::json!(null)).await;
    assert!(err.is_err());
    assert!(err.unwrap_err().to_string().contains("unknown method"));
}

#[tokio::test]
async fn test_ctx_rpc() {
    let mut router = RpcRouter::<AppCtx>::new();
    router.add(CtxGreet);

    let ctx = AppCtx {
        prefix: "yo ".to_string(),
    };
    let input = serde_json::json!({ "name": "world" });

    let result = router.dispatch(&ctx, "ctx_greet", input).await.unwrap();
    let output: GreetOutput = serde_json::from_value(result).unwrap();
    assert_eq!(output.message, "yo world");
}

#[tokio::test]
async fn test_macro_rpc() {
    let mut router = RpcRouter::<()>::new();
    router.add(macro_greet__FnRpc);

    let input = serde_json::json!({ "name": "world" });

    let result = router.dispatch(&(), "macro_greet", input).await.unwrap();
    let output: GreetOutput = serde_json::from_value(result).unwrap();
    assert_eq!(output.message, "macro hello world");
}

#[tokio::test]
async fn test_ts_export() {
    let mut router = RpcRouter::<()>::new();
    router.add(Greet);

    let ts_map = router.export_ts();
    assert!(ts_map.contains_key("greet"));

    let ts = &ts_map["greet"];
    assert!(ts.contains("GreetInput"));
    assert!(ts.contains("GreetOutput"));
}

#[tokio::test]
async fn test_ts_client() {
    let mut router = RpcRouter::<()>::new();
    router.add(Greet);

    let client = router.generate_ts_client("/rpc");
    assert!(client.contains("greet"), "should contain method name");
    assert!(client.contains("GreetInput"), "should contain input type");
    assert!(client.contains("GreetOutput"), "should contain output type");
    assert!(client.contains("Procedures"), "should generate Procedures interface");
    assert!(client.contains("\"query\""), "should contain kind");
}
