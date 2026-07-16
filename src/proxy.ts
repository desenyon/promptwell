import { authkitProxy } from "@workos-inc/authkit-nextjs";

export default authkitProxy({
  debug: false,
});

export const config = {
  matcher: ["/", "/api/refine"],
};
