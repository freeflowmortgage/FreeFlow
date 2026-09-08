resource "aws_route53_zone" "public" {
  count = var.create_hosted_zone ? 1 : 0

  name          = var.domain_name
  force_destroy = false
}

resource "aws_cognito_user_pool" "live_test" {
  count = var.enable_edge && var.enable_cognito_edge ? 1 : 0

  name                     = "${local.name_prefix}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "ON"
  deletion_protection      = "ACTIVE"

  software_token_mfa_configuration {
    enabled = true
  }

  password_policy {
    minimum_length                   = 14
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 1
  }

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  lifecycle {
    precondition {
      condition     = endswith(var.portal_hostname, ".${var.domain_name}")
      error_message = "portal_hostname must be a subdomain of domain_name."
    }
  }
}

resource "aws_cognito_user_pool_client" "alb" {
  count = var.enable_edge && var.enable_cognito_edge ? 1 : 0

  name                                 = "${local.name_prefix}-alb"
  user_pool_id                         = aws_cognito_user_pool.live_test[0].id
  generate_secret                      = true
  prevent_user_existence_errors        = "ENABLED"
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["https://${var.portal_hostname}/oauth2/idpresponse"]
  logout_urls                          = ["https://${var.portal_hostname}/"]
  access_token_validity                = 60
  id_token_validity                    = 60
  refresh_token_validity               = 1

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_domain" "live_test" {
  count = var.enable_edge && var.enable_cognito_edge ? 1 : 0

  domain       = "freeflow-${var.environment}-${data.aws_caller_identity.current.account_id}"
  user_pool_id = aws_cognito_user_pool.live_test[0].id
}

resource "aws_acm_certificate" "portal" {
  count = var.enable_edge && (var.enable_https_certificate || var.enable_cognito_edge) ? 1 : 0

  domain_name       = var.portal_hostname
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "certificate_validation" {
  for_each = var.enable_edge && (var.enable_https_certificate || var.enable_cognito_edge) && !var.dns_managed_externally ? {
    for option in aws_acm_certificate.portal[0].domain_validation_options : option.domain_name => {
      name   = option.resource_record_name
      record = option.resource_record_value
      type   = option.resource_record_type
    }
  } : {}

  zone_id = local.public_hosted_zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "portal" {
  count = var.enable_edge && (var.enable_https_certificate || var.enable_cognito_edge) && !var.dns_managed_externally ? 1 : 0

  certificate_arn         = aws_acm_certificate.portal[0].arn
  validation_record_fqdns = [for record in aws_route53_record.certificate_validation : record.fqdn]
}

resource "aws_lb" "portal" {
  count = var.enable_edge ? 1 : 0

  name                       = "${local.name_prefix}-portal"
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = var.enable_cognito_edge ? [aws_security_group.authenticated_alb[0].id] : [aws_security_group.plte_alb[0].id]
  subnets                    = var.public_subnet_ids
  drop_invalid_header_fields = true
  enable_deletion_protection = false
}

resource "aws_security_group" "authenticated_alb" {
  count = var.enable_edge && var.enable_cognito_edge ? 1 : 0

  name        = "${local.name_prefix}-authenticated-alb-sg"
  description = "Public HTTPS edge protected by Cognito authentication"
  vpc_id      = data.aws_vpc.existing.id

  ingress {
    description = "HTTP redirect to HTTPS"
    protocol    = "tcp"
    from_port   = 80
    to_port     = 80
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Authenticated HTTPS portal"
    protocol    = "tcp"
    from_port   = 443
    to_port     = 443
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description     = "ALB to portal tasks only"
    protocol        = "tcp"
    from_port       = 8000
    to_port         = 8000
    security_groups = [var.app_security_group_id]
  }
}

resource "aws_security_group" "plte_alb" {
  count = var.enable_edge && !var.enable_cognito_edge ? 1 : 0

  name        = "${local.name_prefix}-plte-alb-sg"
  description = "Temporary synthetic-only PLTE access restricted to approved workstations"
  vpc_id      = data.aws_vpc.existing.id

  ingress {
    description = "Approved workstation HTTP access"
    protocol    = "tcp"
    from_port   = 80
    to_port     = 80
    cidr_blocks = var.plte_allowed_ipv4_cidrs
  }

  egress {
    description     = "ALB to portal tasks only"
    protocol        = "tcp"
    from_port       = 8000
    to_port         = 8000
    security_groups = [var.app_security_group_id]
  }
}

resource "aws_security_group_rule" "portal_from_plte_alb" {
  count = var.enable_edge && !var.enable_cognito_edge ? 1 : 0

  type                     = "ingress"
  description              = "Temporary PLTE ALB to portal"
  protocol                 = "tcp"
  from_port                = 8000
  to_port                  = 8000
  security_group_id        = var.app_security_group_id
  source_security_group_id = aws_security_group.plte_alb[0].id
}

resource "aws_security_group_rule" "portal_from_authenticated_alb" {
  count = var.enable_edge && var.enable_cognito_edge ? 1 : 0

  type                     = "ingress"
  description              = "Authenticated ALB to portal"
  protocol                 = "tcp"
  from_port                = 8000
  to_port                  = 8000
  security_group_id        = var.app_security_group_id
  source_security_group_id = aws_security_group.authenticated_alb[0].id
}

resource "aws_lb_target_group" "portal" {
  count = var.enable_edge ? 1 : 0

  name        = "${local.name_prefix}-portal"
  port        = 8000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.aws_vpc.existing.id

  health_check {
    enabled             = true
    path                = "/"
    protocol            = "HTTP"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http_redirect" {
  count = var.enable_edge && var.enable_cognito_edge ? 1 : 0

  load_balancer_arn = aws_lb.portal[0].arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "http_plte" {
  count = var.enable_edge && !var.enable_cognito_edge ? 1 : 0

  load_balancer_arn = aws_lb.portal[0].arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.portal[0].arn
  }
}

resource "aws_lb_listener" "https" {
  count = var.enable_edge && var.enable_cognito_edge ? 1 : 0

  load_balancer_arn = aws_lb.portal[0].arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.dns_managed_externally ? aws_acm_certificate.portal[0].arn : aws_acm_certificate_validation.portal[0].certificate_arn

  default_action {
    order = 1
    type  = "authenticate-cognito"

    authenticate_cognito {
      user_pool_arn              = aws_cognito_user_pool.live_test[0].arn
      user_pool_client_id        = aws_cognito_user_pool_client.alb[0].id
      user_pool_domain           = aws_cognito_user_pool_domain.live_test[0].domain
      on_unauthenticated_request = "authenticate"
      scope                      = "openid email profile"
      session_cookie_name        = "FreeFlowDevAuth"
      session_timeout            = 3600
    }
  }

  default_action {
    order            = 2
    type             = "forward"
    target_group_arn = aws_lb_target_group.portal[0].arn
  }
}

resource "aws_route53_record" "portal" {
  count = var.enable_edge && var.enable_cognito_edge && !var.dns_managed_externally ? 1 : 0

  zone_id = local.public_hosted_zone_id
  name    = var.portal_hostname
  type    = "A"

  alias {
    name                   = aws_lb.portal[0].dns_name
    zone_id                = aws_lb.portal[0].zone_id
    evaluate_target_health = true
  }
}
