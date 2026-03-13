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
  maxWidth?: 560 | 600;
  preview: string;
  title: string;
}

const CONTAINER_CLASS_NAMES = {
  560: "mx-auto w-full max-w-[560px] overflow-hidden rounded-[24px] border border-solid border-[#e9e3f5] bg-white",
  600: "mx-auto w-full max-w-[600px] overflow-hidden rounded-[24px] border border-solid border-[#e9e3f5] bg-white",
} as const;

function SokosumiMark() {
  return (
    <svg
      aria-label="Sokosumi mark"
      fill="none"
      height="24"
      viewBox="0 0 950 950"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M475 0C737.335 0 950 212.665 950 475C950 737.335 737.335 950 475 950C212.665 950 0 737.335 0 475C0 212.665 212.665 0 475 0ZM153 475.721C153 613.086 265.71 724.483 404.701 724.483C543.692 724.483 656.402 613.125 656.402 475.721H586.485C586.485 574.783 504.96 655.361 404.701 655.361C304.442 655.361 222.917 574.745 222.917 475.721H153ZM545.732 225C406.742 225 294.031 337.236 294.031 475.722H363.948C363.948 375.879 445.474 294.666 545.732 294.666C645.991 294.666 727.516 375.918 727.517 475.722H797.434C797.433 337.274 684.723 225 545.732 225Z"
        fill="#6A36FF"
      />
    </svg>
  );
}

export function EmailShell({
  children,
  footer,
  maxWidth = 560,
  preview,
  title,
}: EmailShellProps) {
  return (
    <Html>
      <Head>
        <meta content="light" name="color-scheme" />
        <meta content="light" name="supported-color-schemes" />
      </Head>
      <Preview>{preview}</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-[#f5f3fa] font-sans text-[#17111f]">
          <Section className="px-[16px] py-[32px]">
            <Container className={CONTAINER_CLASS_NAMES[maxWidth]}>
              <Section className="border-b border-solid border-[#ece6f7] bg-[#f8f5ff] px-[28px] py-[18px]">
                <table
                  border={0}
                  cellPadding="0"
                  cellSpacing="0"
                  role="presentation"
                  width="100%"
                >
                  <tbody>
                    <tr>
                      <td width="32" valign="middle">
                        <SokosumiMark />
                      </td>
                      <td valign="middle">
                        <Text className="m-0 text-[13px] font-semibold tracking-[0.12em] text-[#6a36ff] uppercase">
                          Sokosumi
                        </Text>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </Section>
              <Section className="px-[28px] py-[32px]">
                <Heading className="m-0 mb-[10px] p-0 text-left text-[30px] leading-[36px] font-semibold text-[#17111f]">
                  {title}
                </Heading>
                <Hr className="mx-0 mb-[28px] mt-0 w-[64px] border-0 border-t-[3px] border-solid border-[#6a36ff]" />
                {children}
              </Section>
              <Section className="border-t border-solid border-[#ece6f7] bg-[#fcfbff] px-[28px] py-[22px]">
                <Text className="m-0 text-[12px] leading-[20px] text-[#6f6582]">
                  {footer}
                </Text>
              </Section>
            </Container>
          </Section>
        </Body>
      </Tailwind>
    </Html>
  );
}
