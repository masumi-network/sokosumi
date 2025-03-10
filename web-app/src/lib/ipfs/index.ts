export const ipfsUrlResolver = (url: string) => {
  if (url.startsWith("ipfs://")) {
    //NMKR IPFS Gateway
    return url.replace("ipfs://", "https://c-ipfs-gw.nmkr.io/ipfs/");
  }
  return url;
};
