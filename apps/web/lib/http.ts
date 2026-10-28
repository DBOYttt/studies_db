import { NextResponse } from 'next/server';

/** 403 for a state-changing request from another origin (see isCrossOrigin). */
export function forbiddenOrigin(): NextResponse {
  return new NextResponse('Invalid request origin.', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/** 303 with a relative Location, so proxies/tunnels can't leak an internal host. */
export function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}
