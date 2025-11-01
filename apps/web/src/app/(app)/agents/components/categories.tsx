"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Category } from "@/lib/types/category";
import { cn } from "@/lib/utils";

interface CategoriesProps {
  appliedCategories: string[];
  onApplyCategories: (categories: string[]) => void;
  categories: Category[];
}

export default function Categories({
  appliedCategories,
  onApplyCategories,
  categories: validCategories,
}: CategoriesProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [hasDragged, setHasDragged] = useState(false);

  const handleToggleCategory = useCallback(
    (category: string, e?: React.MouseEvent<HTMLButtonElement>) => {
      if (hasDragged) {
        e?.preventDefault();
        return;
      }

      if (appliedCategories.includes(category)) {
        onApplyCategories(appliedCategories.filter((c) => c !== category));
      } else {
        onApplyCategories([...appliedCategories, category]);
      }
    },
    [appliedCategories, onApplyCategories, hasDragged],
  );

  const startDrag = useCallback((pageX: number) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    setIsDragging(true);
    setHasDragged(false);
    setStartX(pageX - container.offsetLeft);
    setScrollLeft(container.scrollLeft);
    container.style.cursor = "grabbing";
    container.style.userSelect = "none";
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      startDrag(e.pageX);
    },
    [startDrag],
  );

  const handleButtonMouseDown = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      startDrag(e.pageX);
    },
    [startDrag],
  );

  const handleButtonTouchStart = useCallback(
    (e: React.TouchEvent<HTMLButtonElement>) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      setIsDragging(true);
      setHasDragged(false);
      setStartX(e.touches[0].pageX - container.offsetLeft);
      setScrollLeft(container.scrollLeft);
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDragging) return;

      const container = scrollContainerRef.current;
      if (!container) return;

      e.preventDefault();
      const x = e.pageX - container.offsetLeft;
      const walk = (x - startX) * 2;
      container.scrollLeft = scrollLeft - walk;

      if (Math.abs(walk) > 5) {
        setHasDragged(true);
      }
    },
    [isDragging, startX, scrollLeft],
  );

  const handleMouseUp = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    setIsDragging(false);
    container.style.cursor = "grab";
    container.style.userSelect = "";

    setTimeout(() => {
      setHasDragged(false);
    }, 0);
  }, []);

  const handleMouseLeave = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    setIsDragging(false);
    container.style.cursor = "grab";
    container.style.userSelect = "";

    setTimeout(() => {
      setHasDragged(false);
    }, 0);
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      setIsDragging(true);
      setHasDragged(false);
      setStartX(e.touches[0].pageX - container.offsetLeft);
      setScrollLeft(container.scrollLeft);
    },
    [],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!isDragging) return;

      const container = scrollContainerRef.current;
      if (!container) return;

      const x = e.touches[0].pageX - container.offsetLeft;
      const walk = (x - startX) * 2;
      container.scrollLeft = scrollLeft - walk;

      if (Math.abs(walk) > 5) {
        setHasDragged(true);
      }
    },
    [isDragging, startX, scrollLeft],
  );

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);

    setTimeout(() => {
      setHasDragged(false);
    }, 0);
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.style.cursor = "grab";

    return () => {
      container.style.cursor = "";
      container.style.userSelect = "";
    };
  }, []);

  if (validCategories.length === 0) {
    return null;
  }

  return (
    <div
      ref={scrollContainerRef}
      className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="flex gap-2">
        {validCategories.map((category) => {
          const isSelected = appliedCategories.includes(category.slug);
          return (
            <Button
              key={category.slug}
              variant={isSelected ? "default" : "outline"}
              size="default"
              onMouseDown={handleButtonMouseDown}
              onTouchStart={handleButtonTouchStart}
              onClick={(e) => handleToggleCategory(category.slug, e)}
              className={cn(
                "shrink-0 text-sm",
                isSelected && "bg-primary text-primary-foreground",
              )}
            >
              {category.name}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
