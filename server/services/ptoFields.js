// Validation for the onboarding fields that are passed on to PTO (residency, Azerbaijani
// name, contract end date). Shared by the HR form (POST /hr/onboarding) and the task
// editor (PATCH /tasks/:id) so both apply PTO's rules.

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FULL_NAME_AZ_MAX_LENGTH = 100; // PTO Person.FullNameAzerbaijani limit

function isIsoDate(value) {
  return ISO_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * Validates the PTO fields present in `input`. `current` holds the values already on the
 * task (empty for a new task) so the contract end date is checked against the effective
 * start date. Returns { values } with only the fields that were sent, or { error }.
 */
function validatePtoFields(input, current = {}, { requireResidency = false } = {}) {
  const values = {};

  if (requireResidency || has(input, "isResident")) {
    const isResident = input.isResident;
    if (isResident === true || isResident === false) {
      values.isResident = isResident;
    } else if (isResident === null && !requireResidency) {
      values.isResident = null;
    } else if (requireResidency && (isResident === null || isResident === undefined || isResident === "")) {
      return { error: "Residency is required (Resident or Non-Resident)" };
    } else {
      return { error: "Residency must be Resident or Non-Resident" };
    }
  }

  if (has(input, "fullNameAzerbaijani")) {
    values.fullNameAzerbaijani = String(input.fullNameAzerbaijani || "").trim().slice(0, FULL_NAME_AZ_MAX_LENGTH);
  }

  if (has(input, "leaveDate")) {
    const leaveDate = String(input.leaveDate || "").trim();
    if (leaveDate && !isIsoDate(leaveDate)) {
      return { error: "Contract end date must be a date in yyyy-MM-dd format" };
    }
    values.leaveDate = leaveDate;
  }

  // PTO rejects a leave date on or before the join date
  const startDate = String(has(input, "startDate") ? input.startDate : current.startDate || "").trim();
  const leaveDate = has(values, "leaveDate") ? values.leaveDate : String(current.leaveDate || "").trim();
  if (leaveDate && isIsoDate(startDate) && leaveDate <= startDate) {
    return { error: "Contract end date must be after the start date" };
  }

  return { values };
}

module.exports = {
  validatePtoFields,
  isIsoDate
};
