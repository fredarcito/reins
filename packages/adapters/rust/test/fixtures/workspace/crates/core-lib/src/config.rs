use std::collections::HashMap;

#[derive(Default)]
pub struct Settings<'a> {
    pub name: &'a str,
}

pub fn quote() -> char {
    '"' // a quote char must not open a string: crate::chat::search
}
