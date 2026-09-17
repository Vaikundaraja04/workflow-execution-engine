/**
 * Extracts a human readable message from an API/network error raised by the AI endpoints.
 */
export function aiErrorMessage(error: unknown, fallback = 'AI request failed. Please try again.'): string {
  const candidate = error as
    | { message?: string; response?: { data?: { message?: string; error?: { message?: string } } } }
    | undefined;

  return (
    candidate?.response?.data?.error?.message ||
    candidate?.response?.data?.message ||
    candidate?.message ||
    fallback
  );
}