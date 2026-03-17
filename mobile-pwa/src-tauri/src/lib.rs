use base64::Engine;

#[tauri::command]
fn write_excel_file(path: String, contents_base64: String) -> Result<(), String> {
  let bytes = base64::engine::general_purpose::STANDARD
    .decode(&contents_base64)
    .map_err(|e: base64::DecodeError| e.to_string())?;
  std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![write_excel_file])
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
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
