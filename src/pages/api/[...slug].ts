import { api } from "@/api";
import type { APIRoute } from "astro";

const handle: APIRoute = ({ request }) => api.handle(request);

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
