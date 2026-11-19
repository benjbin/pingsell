{**
 * NOTICE OF LICENSE
 *
 * This source file is subject to the Academic Free License version 3.0
 * that is bundled with this package in the file LICENSE.
 * It is also available through the world-wide-web at this URL:
 * https://opensource.org/licenses/AFL-3.0
 *
 * DISCLAIMER
 *
 * Do not edit or add to this file if you wish to upgrade this module to newer
 * versions in the future. If you wish to customize this module for your
 * needs please refer to the module documentation (docs/README.md).
 *
 * @author    Pingsell
 * @copyright Since 2024 Pingsell
 * @license   https://opensource.org/licenses/AFL-3.0 Academic Free License version 3.0
 *}
<div class="panel" id="pingsell-connection">
  <div class="panel-heading"><i class="icon-envelope"></i> {l s='Connection to Pingsell' mod='pingsell'}</div>
  {if $pingsell_connected}
    <p class="alert alert-success" id="pingsell-connected">
      {if $pingsell_account}
        {l s='Connected to the Pingsell account' mod='pingsell'} « {$pingsell_account|escape:'htmlall':'UTF-8'} ».
      {else}
        {l s='Your shop is connected to Pingsell.' mod='pingsell'}
      {/if}
    </p>
    <p>{l s='API key:' mod='pingsell'} <code id="pingsell-masked-key">{$pingsell_masked_key|escape:'htmlall':'UTF-8'}</code></p>
    <form method="post" action="{$pingsell_form_action|escape:'htmlall':'UTF-8'}" onsubmit="return confirm('{l s='Disconnect this shop from Pingsell? Events will no longer be sent.' mod='pingsell' js=1}');">
      <button type="submit" name="submitPingsellDisconnect" value="1" class="btn btn-default">
        <i class="icon-unlink"></i> {l s='Disconnect' mod='pingsell'}
      </button>
    </form>
  {else}
    <p>{l s='Link your shop to your Pingsell account in one click: sign in to Pingsell, approve, and you come back here connected.' mod='pingsell'}</p>
    <p class="help-block">{l s='Shop:' mod='pingsell'} <strong>{$pingsell_shop_host|escape:'htmlall':'UTF-8'}</strong></p>
    <form method="post" action="{$pingsell_form_action|escape:'htmlall':'UTF-8'}">
      <button type="submit" name="submitPingsellConnect" value="1" class="btn btn-primary btn-lg" id="pingsell-connect">
        <i class="icon-link"></i> {l s='Connect to Pingsell' mod='pingsell'}
      </button>
    </form>
  {/if}
</div>

<form method="post" action="{$pingsell_form_action|escape:'htmlall':'UTF-8'}" class="defaultForm form-horizontal">
  <div class="panel" id="pingsell-settings">
    <div class="panel-heading"><i class="icon-cogs"></i> {l s='What is sent to Pingsell' mod='pingsell'}</div>
    <div class="form-wrapper">
      <div class="form-group">
        <label class="control-label col-lg-4">{l s='New accounts and newsletter sign-ups' mod='pingsell'}</label>
        <div class="col-lg-8">
          <label class="radio-inline"><input type="radio" name="PINGSELL_SIGNUPS" value="1"{if $pingsell_values.PINGSELL_SIGNUPS} checked="checked"{/if}> {l s='Yes' mod='pingsell'}</label>
          <label class="radio-inline"><input type="radio" name="PINGSELL_SIGNUPS" value="0"{if !$pingsell_values.PINGSELL_SIGNUPS} checked="checked"{/if}> {l s='No' mod='pingsell'}</label>
        </div>
      </div>
      <div class="form-group">
        <label class="control-label col-lg-4">{l s='Abandoned carts' mod='pingsell'}</label>
        <div class="col-lg-8">
          <label class="radio-inline"><input type="radio" name="PINGSELL_CARTS" value="1"{if $pingsell_values.PINGSELL_CARTS} checked="checked"{/if}> {l s='Yes' mod='pingsell'}</label>
          <label class="radio-inline"><input type="radio" name="PINGSELL_CARTS" value="0"{if !$pingsell_values.PINGSELL_CARTS} checked="checked"{/if}> {l s='No' mod='pingsell'}</label>
        </div>
      </div>
      <div class="form-group">
        <label class="control-label col-lg-4">{l s='Orders' mod='pingsell'}</label>
        <div class="col-lg-8">
          <label class="radio-inline"><input type="radio" name="PINGSELL_ORDERS" value="1"{if $pingsell_values.PINGSELL_ORDERS} checked="checked"{/if}> {l s='Yes' mod='pingsell'}</label>
          <label class="radio-inline"><input type="radio" name="PINGSELL_ORDERS" value="0"{if !$pingsell_values.PINGSELL_ORDERS} checked="checked"{/if}> {l s='No' mod='pingsell'}</label>
        </div>
      </div>
      <div class="form-group">
        <label class="control-label col-lg-4">{l s='Shipped orders' mod='pingsell'}</label>
        <div class="col-lg-8">
          <label class="radio-inline"><input type="radio" name="PINGSELL_SHIPMENTS" value="1"{if $pingsell_values.PINGSELL_SHIPMENTS} checked="checked"{/if}> {l s='Yes' mod='pingsell'}</label>
          <label class="radio-inline"><input type="radio" name="PINGSELL_SHIPMENTS" value="0"{if !$pingsell_values.PINGSELL_SHIPMENTS} checked="checked"{/if}> {l s='No' mod='pingsell'}</label>
        </div>
      </div>
      <div class="form-group">
        <label class="control-label col-lg-4">{l s='Pingsell signup form above the footer' mod='pingsell'}</label>
        <div class="col-lg-8">
          <label class="radio-inline"><input type="radio" name="PINGSELL_FOOTER_FORM" value="1"{if $pingsell_values.PINGSELL_FOOTER_FORM} checked="checked"{/if}> {l s='Yes' mod='pingsell'}</label>
          <label class="radio-inline"><input type="radio" name="PINGSELL_FOOTER_FORM" value="0"{if !$pingsell_values.PINGSELL_FOOTER_FORM} checked="checked"{/if}> {l s='No' mod='pingsell'}</label>
        </div>
      </div>
      <div class="form-group">
        <label class="control-label col-lg-4">{l s='Visitor tracking: pages and products viewed, customers recognised (for the “Product viewed without purchase” email)' mod='pingsell'}</label>
        <div class="col-lg-8">
          <label class="radio-inline"><input type="radio" name="PINGSELL_TRACKING" value="1"{if $pingsell_values.PINGSELL_TRACKING} checked="checked"{/if}> {l s='Yes' mod='pingsell'}</label>
          <label class="radio-inline"><input type="radio" name="PINGSELL_TRACKING" value="0"{if !$pingsell_values.PINGSELL_TRACKING} checked="checked"{/if}> {l s='No' mod='pingsell'}</label>
          <p class="help-block" id="pingsell-consent">{l s='Off by default. This tracking uses a cookie: switch it on only if your cookie banner asks for your visitors consent, as required by the GDPR.' mod='pingsell'}</p>
        </div>
      </div>
    </div>
    <div class="panel-footer">
      <button type="submit" name="submitPingsellSettings" value="1" class="btn btn-default pull-right">
        <i class="process-icon-save"></i> {l s='Save' mod='pingsell'}
      </button>
    </div>
  </div>
</form>

<div class="panel" id="pingsell-manual">
  <details>
    <summary><strong>{l s='Manual connection' mod='pingsell'}</strong></summary>
    <form method="post" action="{$pingsell_form_action|escape:'htmlall':'UTF-8'}" class="form-horizontal" style="margin-top:15px">
      <p class="help-block">{l s='Only if the button above does not work: paste the API address and an API key (Pingsell > Integrations > PrestaShop).' mod='pingsell'}</p>
      <div class="form-group">
        <label class="control-label col-lg-3" for="PINGSELL_MANUAL_URL">{l s='API address' mod='pingsell'}</label>
        <div class="col-lg-9">
          <input type="text" id="PINGSELL_MANUAL_URL" name="PINGSELL_MANUAL_URL" value="{$pingsell_api_url|escape:'htmlall':'UTF-8'}" placeholder="https://app.pingsell.neokrome.tech">
        </div>
      </div>
      <div class="form-group">
        <label class="control-label col-lg-3" for="PINGSELL_MANUAL_KEY">{l s='API key' mod='pingsell'}</label>
        <div class="col-lg-9">
          <input type="text" id="PINGSELL_MANUAL_KEY" name="PINGSELL_MANUAL_KEY" value="" autocomplete="off" placeholder="{if $pingsell_masked_key}{$pingsell_masked_key|escape:'htmlall':'UTF-8'}{else}msv_…{/if}">
          <p class="help-block">{l s='Leave empty to keep the current key.' mod='pingsell'}</p>
        </div>
      </div>
      <button type="submit" name="submitPingsellManual" value="1" class="btn btn-default">{l s='Save and test' mod='pingsell'}</button>
    </form>
  </details>
</div>
<p class="text-muted small">Pingsell {$pingsell_version|escape:'htmlall':'UTF-8'}</p>
