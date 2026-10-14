/**
 * Q15 fileLinks, webview side: every openLink of his (markdown links, file rows, search results, references) goes
 * through bridge.request, so a non-web link goes to the fork's "fileLinks.open" first; if that fails, his openLink runs.
 */
import { bridge, Methods } from "../bridge-client";
import { isObject } from "../../shared/bridge";

const his = bridge.request.bind(bridge);
bridge.request = ((method, params, timeoutMs) => {
  if (method !== Methods.openLink || !isObject(params) || typeof params.href !== "string" || /^https?:\/\//i.test(params.href)) return his(method, params, timeoutMs);
  return his(Methods.ours, { ...params, kind: "fileLinks.open" }, timeoutMs).catch(() => his(method, params, timeoutMs));
}) as typeof bridge.request;
