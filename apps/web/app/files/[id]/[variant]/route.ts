import { handleFileRequest } from '@/lib/http-files';
import { requireUser } from '@/lib/session';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; variant: string }> },
) {
  const user = await requireUser(); // redirects to /login-info (307)
  const { id, variant } = await params;
  return handleFileRequest(req, id, variant, user);
}
