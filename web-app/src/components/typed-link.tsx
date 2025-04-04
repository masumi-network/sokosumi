import Link from "next/link";
import { FC } from "react";

import { Routes } from "@/types/routes";

interface TypedLinkProps {
  route: Routes;
  children: React.ReactNode;
  className?: string;
}

const TypedLink: FC<TypedLinkProps> = ({ route, children, className }) => {
  return (
    <Link
      href={{ pathname: route.pathname, query: route.query }}
      className={className}
    >
      {children}
    </Link>
  );
};

export default TypedLink;
