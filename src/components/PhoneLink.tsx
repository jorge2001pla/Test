export default function PhoneLink({ phone }: { phone: string | null | undefined }) {
  return <>{phone ?? "—"}</>;
}
