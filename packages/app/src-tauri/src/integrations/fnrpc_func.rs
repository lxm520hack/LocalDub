use crate::{
    ctx::Ctx,
    feat::{
        file_op::{list_app_directory, read_app_file_bin, read_app_file_text, write_app_file_text},
        other::device_info,
        servers::find_server,
        tasks::{get_group_list, get_task_ctx, log::watch_task_log},
    },
};
use std::sync::atomic::{AtomicU64, Ordering};

#[fnrpc::rpc_query]
pub async fn health_check() -> &'static str {
    "ok"
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

#[fnrpc::rpc_query]
pub async fn get_count() -> String {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("count: {n}")
}

#[fnrpc::rpc_mutate]
pub async fn reset_count() -> () {
    COUNTER.store(0, Ordering::Relaxed);
}

pub fn build_fn_rpc_router() -> fnrpc::router::RpcRouter<Ctx> {
    fnrpc::router::RpcRouter::<Ctx>::new()
        .query(read_app_file_text)
        .mutate(write_app_file_text)
        .query(read_app_file_bin)
        .query(list_app_directory)
        .subscribe(watch_task_log)
        .query(get_group_list)
        .query(get_task_ctx)
        .mutate(reset_count)
        .query(find_server)
        .query(device_info)
    // .query(crate::feat::demo::func::greet)
    // .query(crate::feat::demo::func::add)
    // .query(crate::feat::demo::func::get_user)
    // .query(crate::feat::demo::func::divide)
    // .mutate(crate::feat::demo::func::create_user)
    // .subscribe(crate::feat::demo::func::tick)
    // .subscribe(crate::feat::demo::func::echo_stream)
    // .subscribe(crate::feat::demo::func::watch_status)
}
