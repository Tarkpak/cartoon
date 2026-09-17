# AutoDL H3

## Configuration

Create a token in https://autodl.art/large-model/tokens with the ComfyUI group.
Deploy the updated admin backend, open Model Providers > AutoDL, and save the ComfyUI Token.
The default Base URL is https://autodl.art (no /v1 suffix). Enable the desired workflows.
Sign in or synchronize the client, then select an H3 workflow under Settings > Model
Assignment or Model Testing. The current client requires a backend login and manages
credentials centrally; the legacy local credentials API also supports AutoDL.

| Workflow | Inputs | Duration |
| --- | --- | --- |
| minimax_h3_zm_u24 | 1-9 images, 0-3 audio references; upgraded quality | 1-15 seconds |
| minimax_h3_zm_u08 | 1-9 images, 0-3 audio references; fast | 1-15 seconds |
| minimax_h3_lightx2v_no_pic | Text only | 1-15 seconds |
| minimax_h3_lightx2v | Both first and last frames required | 1-10 seconds |

Model testing exposes 480p and 768p, with landscape, portrait and square output.
Global video settings also expose H3 quality (480p or 768p) when an AutoDL workflow
is selected. This setting is saved and used for scene generation; existing configurations
default to 768p. Model testing continues to use its own resolution selection.
Existing scene requests using the shared 720p default map to H3's 768p preset.
1080p and 4K are rejected. Scene/script duration rules remain independent of the model test limits.

## Media And Tasks

AutoDL requires remotely accessible HTTP(S) reference URLs. Configure TOS for local images
and audio; inline base64 and local filesystem paths cannot be sent directly to AutoDL.
The backend submits a workflow once, persists its task ID, polls results, and saves the
video immediately because the upstream URL expires. Status queries can resume checking
persisted processing tasks after a restart. Transient query failures are retried;
submission is never automatically retried to avoid creating duplicate paid tasks.
Repeated transport errors or the background polling deadline leave the upstream task
in processing so subsequent status requests can recover it. Only a completed generation
emits a billable success log; submission and polling logs are pending.

The scene workbench currently does not provide a dedicated first/last-frame input pair.
Use model testing or the video generation API for the first/last-frame workflow; the
asset API accepts explicit top-level firstFrame and lastFrame inputs. A scene's previously
generated lastFrame is an output and is not automatically reused as the requested end frame.
For normal scene generation choose a multi-image workflow or the text-only workflow.

Authorization sends the raw token, without a Bearer prefix. Both SUCCESS and completed
are accepted as terminal success states. Credentials are omitted from client responses
and request logs. Existing settings export/import behavior also applies to AutoDL.

Sources verified 2026-09-17:
- https://autodl.art/docs/comfyui_api/
- https://autodl.art/large-model/comfyui

Real generation requires an account with a funded ComfyUI token. Automated verification
uses synthetic credentials and a local mock service; it does not incur upstream charges.
Run `cargo build --manifest-path src-tauri/Cargo.toml --bin playlet-backend` followed by
`bun scripts/test-autodl-integration.mjs` to repeat the isolated integration check.
