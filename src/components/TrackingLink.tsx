export default function TrackingLink({ carrier, trackingLink }: { carrier: string; trackingLink: string }) {
  const isUrl = /^https?:\/\//i.test(trackingLink);
  if (!isUrl) {
    return (
      <>
        {carrier} — {trackingLink}
      </>
    );
  }
  return (
    <>
      {carrier} —{" "}
      <a
        href={trackingLink}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-gold"
      >
        Track Package
      </a>
    </>
  );
}
