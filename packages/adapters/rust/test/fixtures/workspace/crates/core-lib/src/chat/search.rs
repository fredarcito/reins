use super::Turn;

pub fn rank() {
    // super::store::load() in a comment is no dependency
    let _ = "super::store::load()";
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::store;

    fn t() { store::load(); rank(); }
}
