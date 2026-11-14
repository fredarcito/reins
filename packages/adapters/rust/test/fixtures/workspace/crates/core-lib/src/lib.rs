pub mod chat;
mod config;
#[path = "gen/bindings.rs"]
mod generated;
mod missing;

use config::Settings;

pub fn run() -> Settings {
    generated::call();
    Settings::default()
}
