import Image from "next/image";

interface TestimonialProps {
  image: string;
  quote: string;
  name: string;
  position: string;
  company: string;
  index: number;
}

const Testimonial = ({
  image,
  quote,
  name,
  position,
  company,
  index,
}: TestimonialProps) => (
  <div className="flex-start stretch border-foreground/10 flex gap-12 border-t py-4">
    <div className="relative flex w-[77px] min-w-[77px] flex-col justify-between">
      <Image
        src={image}
        alt={name}
        className="h-[96px] w-[77px] object-cover"
        width={77}
        height={96}
      />
      <span className="text-muted-foreground text-sm">
        {index < 10 ? "0" : ""}
        {index + 1}
      </span>
    </div>
    <div className="flex w-full flex-col gap-16">
      <p className="text-3xl">{`"${quote}"`}</p>
      <div className="text-sm">
        <div>{name}</div>
        <div className="text-muted-foreground">
          {position} {"at"} {company}
        </div>
      </div>
    </div>
  </div>
);

export default function Testimonials() {
  const testimonials = [
    {
      image: "/images/user-1.png",
      quote:
        "Using this platform has saved us so much time. It's a game changer!",
      name: "Nina Müller",
      position: "Chief Operating Officer",
      company: "Cosa travel",
    },
    {
      image: "/images/user-2.png",
      quote:
        "Since we started using this platform, our team morale has soared!",
      name: "Firstname Lastname",
      position: "[Profession]",
      company: "[Company]",
    },
  ];

  return (
    <div className="relative flex w-full flex-col gap-12">
      <h2 className="text-left text-5xl font-light">{"What our Users Say"}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {testimonials.map((testimonial, index) => (
          <Testimonial key={index} {...testimonial} index={index} />
        ))}
      </div>
    </div>
  );
}
