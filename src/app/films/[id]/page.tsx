import { Studio } from "@/components/studio/Studio";

export default async function FilmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Studio filmId={id} />;
}
