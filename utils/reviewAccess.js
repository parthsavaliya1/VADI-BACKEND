// Legacy seeded account remains supported until configured in the admin panel.
const identities = { user: { phone: '+919990000101' } };
function isReviewEnabled(user) {
  if (user.isDemo !== true || user.status === 'blocked' || user.isActive === false) return false;
  if (typeof user.reviewEnabled === 'boolean') return user.reviewEnabled;
  return process.env.ENABLE_REVIEW_ACCOUNTS === 'true' && user.phone === identities.user.phone;
}
function reviewAccessEnabled(user) { return isReviewEnabled(user) && Boolean(user.reviewOtpHash); }
module.exports = { identities, isReviewEnabled, reviewAccessEnabled };
