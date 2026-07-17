export default function PhoneLink({ phone }: { phone: string | null | undefined }) {
  if (!phone || phone === "—") return <>{phone ?? "—"}</>;
  return (
    <a href={`tel:${phone}`} className="hover:text-gold hover:underline">
      {phone}
    </a>
  );
}
