use config_rs::servers::ServerType;
use core_rs::cmd::tasks::get_group_list::{get_group_list, GroupInfo};
use core_rs::servers::discovery::{find_server, ServerInfo};
use device_rs::DeviceInfo;
// Checkout the official docs at https://rspc.dev. This documentation is generally written for authors of middleware and adapter.
use rspc::{Procedure, ProcedureError, ResolverError, Router};
use serde::Serialize;
use specta::Type;

use crate::commands;
use crate::state::AppState;

#[derive(Debug, Serialize, Type)]
pub struct RspcErr(pub String);

impl rspc::Error for RspcErr {
    fn into_procedure_error(self) -> ProcedureError {
        ProcedureError::Resolver(ResolverError::new(self.0, None::<std::io::Error>))
    }
}

pub fn build() -> Router<AppState> {
    Router::<AppState>::new()
        // .procedure(
        //     "version",
        //     Procedure::<AppState, (), &'static str>::builder::<RspcErr>()
        //         .query(|_ctx: AppState, _input: ()| async move { Ok("0.1.0") }),
        // )
        .procedure(
            "startTorch",
            Procedure::<AppState, (), u16>::builder::<RspcErr>()
                .mutation(|ctx: AppState, _input: ()| async move {
                    commands::start_torch(&ctx).map_err(RspcErr)
                }),
        )
        .procedure(
            "stopTorch",
            Procedure::<AppState, (), ()>::builder::<RspcErr>()
                .mutation(|ctx: AppState, _input: ()| async move {
                    commands::stop_torch(&ctx).map_err(RspcErr)
                }),
        )
        .procedure(
            "checkTorch",
            Procedure::<AppState, (), bool>::builder::<RspcErr>()
                .query(|ctx: AppState, _input: ()| async move {
                    Ok(commands::check_torch(&ctx))
                }),
        )
        .procedure(
            "startVoxcpm",
            Procedure::<AppState, (), u16>::builder::<RspcErr>()
                .mutation(|ctx: AppState, _input: ()| async move {
                    commands::start_voxcpm(&ctx).map_err(RspcErr)
                }),
        )
        .procedure(
            "stopVoxcpm",
            Procedure::<AppState, (), ()>::builder::<RspcErr>()
                .mutation(|ctx: AppState, _input: ()| async move {
                    commands::stop_voxcpm(&ctx).map_err(RspcErr)
                }),
        )
    // .procedure(
    //     "deviceInfo",
    //     Procedure::<AppState, (), DeviceInfo>::builder::<RspcErr>()
    //         .query(|ctx: AppState, _input: ()| async move {
    //             commands::device_info(&ctx).map_err(RspcErr)
    //         }),
    // )
    // .procedure(
    //     "readInput",
    //     Procedure::<AppState, (), String>::builder::<RspcErr>()
    //         .query(|ctx: AppState, _input: ()| async move {
    //             commands::read_input(&ctx).map_err(RspcErr)
    //         }),
    // )
    // .procedure(
    //     "writeInput",
    //     Procedure::<AppState, String, ()>::builder::<RspcErr>()
    //         .mutation(|ctx: AppState, input: String| async move {
    //             commands::write_input(&ctx, input).map_err(RspcErr)
    //         }),
    // )
    // .procedure(
    //     "readInputSchema",
    //     Procedure::<AppState, (), String>::builder::<RspcErr>()
    //         .query(|ctx: AppState, _input: ()| async move {
    //             commands::read_input_schema(&ctx).map_err(RspcErr)
    //         }),
    // )
    // .procedure(
    //     "getGroupList",
    //     Procedure::<AppState, (), Vec<GroupInfo>>::builder::<RspcErr>()
    //         .query(|_ctx: AppState, _input: ()| async move {
    //             eprintln!("[RSPC] ▶ query getGroupList");
    //             let result = get_group_list().map_err(RspcErr);
    //             match &result {
    //                 Ok(list) => eprintln!("[RSPC] ✔ getGroupList ({} groups)", list.len()),
    //                 Err(e) => eprintln!("[RSPC] ✗ getGroupList: {e:?}"),
    //             }
    //             result
    //         }),
    // )
    // .procedure(
    //     "find_server",
    //     Procedure::<AppState, ServerType, ServerInfo>::builder::<RspcErr>().query(|_ctx: AppState, input: ServerType| async move {
    //         Ok(find_server(input).await)
    //     }),
    // )
}
