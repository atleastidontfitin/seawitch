export type Order = {
  id: string;
  expedited: boolean;
  items: number;
};

export type Receipt = {
  orderId: string;
  total: number;
  copy: string;
};
