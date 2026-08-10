import Image from "next/image";

interface AuthHeroBackgroundProps {
  readonly sizes: string;
}

export function AuthHeroBackground({ sizes }: AuthHeroBackgroundProps) {
  return (
    <>
      <Image src="/auth-background.png" alt="" fill priority sizes={sizes} className="object-cover dark:hidden" />
      <Image
        src="/auth-background-dark.png"
        alt=""
        fill
        priority
        sizes={sizes}
        className="hidden object-cover dark:block"
      />
    </>
  );
}
