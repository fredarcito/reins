// the binary reaches the library through its crate name
fn main() {
    core_lib::chat::store::load();
    ::serde::json(); // external, absolute
}
