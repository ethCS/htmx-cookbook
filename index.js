// tiny firebase entry file
// just hooks the express app into hosting / functions
import { onRequest } from "firebase-functions/v2/https";
import { app } from "./server.js";

export const api = onRequest({ region: "us-central1" }, app);
