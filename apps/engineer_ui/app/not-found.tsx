import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty">
      <h1>This catalog entry does not exist.</h1>
      <Link className="text-link" href="/">
        Return to studio overview →
      </Link>
    </div>
  );
}
