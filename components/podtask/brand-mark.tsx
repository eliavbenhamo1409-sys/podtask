import Image from "next/image";
import { cn } from "@/lib/utils";

interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 40, className }: BrandMarkProps) {
  return (
    <Image
      src="/podtask-logo.png"
      alt="Podtask"
      width={size}
      height={size}
      priority
      className={cn("brand-mark-img", className)}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}
