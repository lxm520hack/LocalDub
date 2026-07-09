pub mod error;
pub mod handler;
pub mod router;

pub use fnrpc_macros::{fnrpc_registry, rpc_query, rpc_mutation, rpc_subscription};
