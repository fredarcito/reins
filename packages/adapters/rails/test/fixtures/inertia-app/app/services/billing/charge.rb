module Billing
  class Charge
    def initialize(invoice)
      @invoice = invoice
    end

    def call
      # Mailer comes from a gem, ::User is absolute
      Stripe::Charge.create(amount: @invoice.total) if ::User.any? && Invoice.any?
    end
  end
end
