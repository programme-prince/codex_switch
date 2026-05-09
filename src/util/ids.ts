import { customAlphabet } from "nanoid";

const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const nanoid24 = customAlphabet(alphabet, 24);

export function newResponseId(): string {
  return `resp_${nanoid24()}`;
}

export function newMessageId(): string {
  return `msg_${nanoid24()}`;
}

export function newFunctionCallId(): string {
  return `fc_${nanoid24()}`;
}

export function newReasoningId(): string {
  return `rs_${nanoid24()}`;
}

export function newCallId(): string {
  return `call_${nanoid24()}`;
}
