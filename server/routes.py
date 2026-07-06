from dataclasses import dataclass


@dataclass(frozen=True)
class HttpRoute:
    path: str
    handler: str


@dataclass(frozen=True)
class ActionRoute:
    action: str
    handler: str
    pass_body: bool = True


GET_EXACT_ROUTES = (
    HttpRoute('/workspace', 'handle_workspace_info'),
    HttpRoute('/health', 'handle_health_get'),
)

GET_PREFIX_ROUTES = (
    HttpRoute('/lms-proxy', 'handle_lms_proxy_get'),
    HttpRoute('/music-file', 'handle_music_file_get'),
    HttpRoute('/preview-file', 'handle_preview_file_get'),
    HttpRoute('/remote-heartbeat', 'handle_remote_heartbeat_get'),
)

POST_PREFIX_ROUTES = (
    HttpRoute('/llm-proxy', 'handle_llm_proxy_post'),
    HttpRoute('/lms-login', 'handle_lms_login_post'),
    HttpRoute('/lms-scores', 'handle_lms_scores_post'),
    HttpRoute('/lms-schedule', 'handle_lms_schedule_post'),
    HttpRoute('/lms-empty-rooms', 'handle_lms_empty_rooms_post'),
    HttpRoute('/lms-attendance', 'handle_lms_attendance_post'),
    HttpRoute('/lms-judge', 'handle_lms_judge_post'),
    HttpRoute('/lms-training-plan', 'handle_lms_training_plan_post'),
)

ACTION_ROUTES = (
    ActionRoute('execute', 'handle_execute'),
    ActionRoute('remote_execute', 'handle_remote_execute'),
    ActionRoute('workspace_info', 'handle_workspace_info', pass_body=False),
    ActionRoute('open_terminal', 'handle_open_terminal'),
    ActionRoute('read_file', 'handle_read_file'),
    ActionRoute('read_file_binary', 'handle_read_file_binary'),
    ActionRoute('write_file', 'handle_write_file'),
    ActionRoute('append_file', 'handle_append_file'),
    ActionRoute('edit_file', 'handle_edit_file'),
    ActionRoute('apply_patch', 'handle_apply_patch'),
    ActionRoute('list_checkpoints', 'handle_list_checkpoints'),
    ActionRoute('restore_checkpoint', 'handle_restore_checkpoint'),
    ActionRoute('delete_file', 'handle_delete_file'),
    ActionRoute('rename_file', 'handle_rename_file'),
    ActionRoute('copy_file', 'handle_copy_file'),
    ActionRoute('move_file', 'handle_move_file'),
    ActionRoute('list_dir', 'handle_list_dir'),
    ActionRoute('create_file', 'handle_create_file'),
    ActionRoute('create_dir', 'handle_create_dir'),
    ActionRoute('search', 'handle_search'),
    ActionRoute('web_search', 'handle_web_search'),
    ActionRoute('fetch_url', 'handle_fetch_url'),
    ActionRoute('open_file_default', 'handle_open_file_default'),
    ActionRoute('compile_tex', 'handle_compile_tex'),
    ActionRoute('file_info', 'handle_file_info'),
    ActionRoute('git', 'handle_git'),
    ActionRoute('generate_ppt', 'handle_generate_ppt'),
    ActionRoute('ppt_task', 'handle_ppt_task'),
    ActionRoute('screenshot', 'handle_screenshot'),
    ActionRoute('list_windows', 'handle_list_windows'),
    ActionRoute('mcp_list_tools', 'handle_mcp_list_tools'),
    ActionRoute('mcp_call_tool', 'handle_mcp_call_tool'),
    ActionRoute('skill_list', 'handle_skill_list'),
    ActionRoute('skill_read', 'handle_skill_read'),
    ActionRoute('music', 'handle_music_action'),
    ActionRoute('select_workspace', 'handle_select_workspace'),
    ActionRoute('set_workspace', 'handle_set_workspace'),
    ActionRoute('remote_connect', 'handle_remote_connect'),
    ActionRoute('remote_status', 'handle_remote_status'),
    ActionRoute('remote_list_dirs', 'handle_remote_list_dirs'),
    ActionRoute('remote_disconnect', 'handle_remote_disconnect'),
    ActionRoute('wechat_bridge', 'handle_wechat_bridge'),
)

ACTION_ROUTE_BY_NAME = {route.action: route for route in ACTION_ROUTES}
