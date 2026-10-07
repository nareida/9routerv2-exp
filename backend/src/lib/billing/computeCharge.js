/**
 * Cost arithmetic shared by pre-flight estimate (quotaGuard) and
 * post-request settle (chargeRequest) so the two can never drift apart.
 *
 * Mirrors one-hub's relay/relay_util/quota.go:
 *   inputRatio  = price.input  * groupRatio
 *   outputRatio = price.output * groupRatio
 *   cost        = promptTokens*inputRatio + completionTokens*outputRatio
 *
 * Derived from One Hub (https://github.com/songquanpeng/one-hub),
 * Copyright 2023 The One Hub Authors, licensed under Apache-2.0.
 * Rewritten for 9router's key/balance model; see README "Credits"
 * for the full derivation list.
 */
export function computeCharge({ promptTokens, completionTokens, price, groupRatio = 1 }) {
  const ratio = Number(groupRatio);
  const inputRatio = Number(price?.input ?? 1) * ratio;
  const outputRatio = Number(price?.output ?? 2) * ratio;
  return Math.round(promptTokens * inputRatio + completionTokens * outputRatio);
}
