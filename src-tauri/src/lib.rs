use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager, State, Url, WebviewWindow};

struct StudioProcess(Mutex<Option<Child>>);

fn port_open() -> bool {
    let address: SocketAddr = "127.0.0.1:4310".parse().expect("valid local address");
    TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok()
}

fn navigate(window: &WebviewWindow) -> Result<(), String> {
    let url = Url::parse("http://127.0.0.1:4310").map_err(|error| error.to_string())?;
    window.navigate(url).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_existing(window: WebviewWindow) -> Result<bool, String> {
    if port_open() {
        navigate(&window)?;
        return Ok(true);
    }
    Ok(false)
}

fn start_blocking(window: WebviewWindow, app: AppHandle, project: String) -> Result<(), String> {
    if port_open() {
        return navigate(&window);
    }

    let root = PathBuf::from(&project);
    if !root.join("studio/server.ts").is_file() || !root.join("package.json").is_file() {
        return Err("That folder does not look like an Auteur project. Pick the folder containing studio/server.ts and package.json.".into());
    }
    if !root.join("node_modules").is_dir() {
        return Err("node_modules is missing. Run `pnpm install` in the project folder, then try again.".into());
    }

    let node = Command::new("node")
        .arg("--version")
        .output()
        .map_err(|error| format!("Node.js was not found on PATH: {error}"))?;
    if !node.status.success() {
        return Err("Node.js was found but could not run. Install Node 22+ and try again.".into());
    }

    let ffmpeg = Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map_err(|error| format!("FFmpeg was not found on PATH: {error}"))?;
    if !ffmpeg.status.success() {
        return Err("FFmpeg was found but could not run. Install FFmpeg and try again.".into());
    }

    let runs = root.join("runs");
    fs::create_dir_all(&runs).ok();
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(runs.join("studio-launcher.log"))
        .ok();

    let mut command = Command::new("node");
    command
        .args(["--import", "tsx", "studio/server.ts"])
        .current_dir(&root)
        .stdin(Stdio::null());

    match log {
        Some(file) => {
            let stderr = file.try_clone().map_err(|error| error.to_string())?;
            command.stdout(file).stderr(stderr);
        }
        None => {
            command.stdout(Stdio::null()).stderr(Stdio::null());
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let child = command
        .spawn()
        .map_err(|error| format!("Could not start the Studio server: {error}"))?;

    {
        let state = app.state::<StudioProcess>();
        let mut guard = state.0.lock().map_err(|error| error.to_string())?;
        *guard = Some(child);
    }

    for _ in 0..220 {
        if port_open() {
            return navigate(&window);
        }
        thread::sleep(Duration::from_millis(300));
    }

    if let Some(state) = app.try_state::<StudioProcess>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() {
                child.kill().ok();
            }
        }
    }
    Err("Studio did not start within 66 seconds. Check runs/studio-launcher.log in the project folder.".into())
}

#[tauri::command]
async fn start_studio(
    window: WebviewWindow,
    app: AppHandle,
    project: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || start_blocking(window, app, project))
        .await
        .map_err(|error| format!("Studio start task failed: {error}"))?
}

#[tauri::command]
fn stop_studio(state: State<StudioProcess>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|error| error.to_string())?;
    if let Some(mut child) = guard.take() {
        child.kill().ok();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(StudioProcess(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_existing,
            start_studio,
            stop_studio
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.app_handle().state::<StudioProcess>();
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(mut child) = guard.take() {
                        child.kill().ok();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Auteur Studio");
}
