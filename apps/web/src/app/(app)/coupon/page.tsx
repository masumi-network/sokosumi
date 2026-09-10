import { redirect } from "next/navigation";

export default function CouponPage() {
  redirect("/billing?tab=coupon");
}
