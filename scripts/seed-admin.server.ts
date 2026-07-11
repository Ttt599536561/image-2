import { getSql } from "../src/db/db.server";
import { onUserRegistered } from "../src/lib/auth-hooks";
import { auth } from "../src/lib/auth";

export async function seedAdminAccount(email: string, password: string): Promise<void> {
  const context = await auth.$context;
  const existingAuth = await context.internalAdapter.findUserByEmail(email, {
    includeAccounts: true,
  });

  if (existingAuth) {
    const credential = existingAuth.accounts.find((account) => account.providerId === "credential");
    if (!credential) {
      throw new Error(`Existing authentication user ${email} has no credential account`);
    }
    const passwordHash = await context.password.hash(password);
    await context.internalAdapter.updatePassword(existingAuth.user.id, passwordHash);
    await onUserRegistered({ id: existingAuth.user.id, email: existingAuth.user.email });
    console.log(`Updated administrator credential for ${email}`);
  } else {
    await auth.api.signUpEmail({ body: { email, password, name: email } });
    console.log(`Registered administrator account ${email}`);
  }

  const sql = getSql();
  const businessUsers = (await sql`UPDATE users SET role='admin', updated_at=now()
    WHERE email=${email} RETURNING id`) as { id: string }[];
  if (businessUsers.length === 0) {
    throw new Error(`Administrator ${email} is missing from the business users table`);
  }

  const hasRole = await sql`SELECT 1 FROM information_schema.columns
    WHERE table_name='user' AND column_name='role'`;
  if (hasRole.length === 0) {
    throw new Error('Better Auth user.role is missing; apply database migrations first');
  }
  await sql`UPDATE "user" SET role='admin' WHERE email=${email}`;
}
