import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

import App from "../App";

export default async function HomePage() {
  const { user } = await withAuth();
  if (!user) redirect("/auth/sign-in");

  return (
    <App
      user={{
        id: user.id,
        email: user.email,
        firstName: user.firstName,
      }}
    />
  );
}
