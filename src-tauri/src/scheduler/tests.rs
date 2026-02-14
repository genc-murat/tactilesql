use super::compute_retry_delay_ms;

#[test]
fn retry_delay_scales_with_attempt() {
    assert_eq!(compute_retry_delay_ms(0, 1), 0);
    assert_eq!(compute_retry_delay_ms(250, 1), 250);
    assert_eq!(compute_retry_delay_ms(250, 3), 750);
}

#[test]
fn retry_delay_uses_saturating_math() {
    let result = compute_retry_delay_ms(u64::MAX, 2);
    assert_eq!(result, u64::MAX);
}
