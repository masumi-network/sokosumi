import { Body } from "@react-email/body";
import { Container } from "@react-email/container";
import { Head } from "@react-email/head";
import { Heading } from "@react-email/heading";
import { Hr } from "@react-email/hr";
import { Html } from "@react-email/html";
import { Preview } from "@react-email/preview";
import { Section } from "@react-email/section";
import { Tailwind } from "@react-email/tailwind";
import { Text } from "@react-email/text";
import type { ReactNode } from "react";

export interface EmailShellProps {
  children: ReactNode;
  footer: string;
  maxWidth?: number;
  preview: string;
  title: string;
}

export function EmailShell({
  children,
  footer,
  maxWidth = 465,
  preview,
  title,
}: EmailShellProps) {
  const containerClassName =
    maxWidth === 600
      ? "mx-auto w-full max-w-[600px] rounded border border-solid border-[#eaeaea] p-[20px]"
      : "mx-auto w-full max-w-[465px] rounded border border-solid border-[#eaeaea] p-[20px]";

  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Section className="px-[20px] py-[40px]">
            <Container className={containerClassName}>
              <Heading className="mx-0 my-[30px] p-0 text-center text-[24px] font-normal text-black">
                {title}
              </Heading>
              {children}
              <Hr className="mx-0 my-[26px] w-full border border-solid border-[#eaeaea]" />
              <Text className="m-0 text-[12px] leading-[24px] text-[#666666]">
                {footer}
              </Text>
            </Container>
          </Section>
        </Body>
      </Tailwind>
    </Html>
  );
}
