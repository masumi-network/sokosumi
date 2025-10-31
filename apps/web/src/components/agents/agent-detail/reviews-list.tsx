"use client";

import { UserAgentRatingWithUser } from "@sokosumi/database";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { RatingListItem } from "@/components/agents/rating-list-item";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";

const PAGE_SIZE = 5;

interface ReviewsListProps {
  ratingsWithComments: UserAgentRatingWithUser[];
}

export function ReviewsList({ ratingsWithComments }: ReviewsListProps) {
  const t = useTranslations("Components.Agents.Reviews");
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.ceil(ratingsWithComments.length / PAGE_SIZE);
  const currentPageRatings = ratingsWithComments.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  return (
    <div className="flex h-full flex-col">
      {totalPages > 1 && (
        <div className="mb-4 shrink-0">
          <Pagination>
            <PaginationContent className="p-2">
              <PaginationItem>
                <PaginationLink
                  onClick={() => setCurrentPage(1)}
                  isActive={currentPage > 1}
                >
                  <ChevronsLeft />
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  isActive={currentPage > 1}
                >
                  <ChevronLeft />
                </PaginationLink>
              </PaginationItem>
              <div className="mx-1">
                <p className="text-sm">
                  {t("Pagination.page", { page: currentPage, totalPages })}
                </p>
              </div>
              <PaginationItem>
                <PaginationLink
                  onClick={() =>
                    setCurrentPage(Math.min(totalPages, currentPage + 1))
                  }
                  isActive={currentPage < totalPages}
                >
                  <ChevronRight />
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink
                  onClick={() => setCurrentPage(totalPages)}
                  isActive={currentPage < totalPages}
                >
                  <ChevronsRight />
                </PaginationLink>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
      <div className="flex-1 space-y-4">
        {currentPageRatings.map((rating) => (
          <RatingListItem key={rating.id} rating={rating} />
        ))}
      </div>
    </div>
  );
}
