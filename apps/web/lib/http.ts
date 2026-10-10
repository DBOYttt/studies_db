import { NextResponse } from 'next/server';

/** 303 with a relative Location, so proxies/tunnels can't leak an internal host. */
export function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}
