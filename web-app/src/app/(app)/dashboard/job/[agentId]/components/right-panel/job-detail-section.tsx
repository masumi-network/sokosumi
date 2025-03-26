interface JobDetailSectionProps {
  jobId: string;
}

export default function JobDetailSection({ jobId }: JobDetailSectionProps) {
  return <div>{jobId}</div>;
}
