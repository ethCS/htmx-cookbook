// Firebase Cloud Functions entry point.
// Wraps the Express app as an HTTPS function so Firebase Hosting can proxy to it.
import { onRequest } from "firebase-functions/v2/https";
import { app } from "./server.js";

export const api = onRequest(
	{
		region: "us-central1",
		maxInstances: 1,
	},
	app,
);
