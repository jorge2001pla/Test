import Image from "next/image";
import { loginAction } from "@/app/auth-actions";

export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-sm flex-col items-center justify-center">
      <div className="w-full rounded-lg border border-border bg-card p-8">
        <div className="flex flex-col items-center gap-2">
          <Image src="/brand/eagle-mark-512.png" alt="" width={56} height={56} priority className="h-14 w-14" />
          <h1 className="font-sans text-xl font-bold tracking-widest text-gold">PRC</h1>
          <p className="text-sm text-muted-foreground">Command Center</p>
        </div>

        {error && (
          <p className="mt-4 rounded border border-red-600/40 bg-red-600/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            Wrong username or password. Try again.
          </p>
        )}

        <form action={loginAction} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              required
              autoComplete="username"
              autoFocus
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            className="w-full rounded bg-gold px-4 py-2 text-sm font-medium text-brand-black transition-opacity hover:opacity-90"
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}
