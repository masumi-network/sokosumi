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

const EMAIL_LOGO_URL =
  "https://igcd4cnfvuav1zto.public.blob.vercel-storage.com/brand/sokosumi-logo-wordmark-black.png";
const EMAIL_MARK_URL =
  "https://igcd4cnfvuav1zto.public.blob.vercel-storage.com/brand/sokosumi-logo.png";

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
                      <td valign="middle" width="34">
                        <img
                          alt="Sokosumi logo"
                          height="24"
                          src={EMAIL_MARK_URL}
                          width="24"
                        />
                      </td>
                      <td valign="middle">
                        <img
                          alt="Sokosumi"
                          height="20"
                          src={EMAIL_LOGO_URL}
                          width="156"
                        />
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
