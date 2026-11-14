use crate::{config::{self, Settings as Conf}, chat};

pub fn load() {
    let _ = r#"crate::lib::nothing "quoted" "#;
    chat::search::rank();
    let _: Conf = Default::default();
    let _ = config::quote();
}
