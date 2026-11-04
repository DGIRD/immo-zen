# Jeux d'essai de la sécurisation EDI-TDFC

Ces fichiers proviennent du **pack technique « nouvelle sécurisation EDI » v1.1** publié par la DGFiP dans l'espace des partenaires EDI d'impots.gouv.fr (documentation technique).

| Fichier | Origine dans le pack | Contenu |
| --- | --- | --- |
| `dgfip_groupe_signe.txt` | `4_verifier_nouvelle_signature_infent_cr_rcs/B_ung_a_controler.txt` | Groupe fonctionnel signé par la DGFiP (compte rendu CONTRL) |
| `dgfip_signature.hex` | `…/E_signature.hexa` | Signature DGFiP de ce groupe |
| `dgfip_cle_publique_pedi.pem` | `…/0_cle_publique_DGFiP_PEDI.pem` | Clé publique de la DGFiP pour vérifier ses comptes rendus |
| `partenaire_fictif_cles.pem` | `0_generation_cles_partenaire/cles_partenaire.pem` | Clés d'un **partenaire fictif** (mot de passe publié : `clespedi2048`) |
| `partenaire_fictif_accreditation.txt` | `2_creation_accreditation_par_DGFiP/accreditation_pedi.txt` | Accréditation fictive (SIRET 07955542100019) |

Les clés et l'accréditation sont celles de l'exemple public de la DGFiP : elles n'ont **aucune valeur** pour un envoi réel. La clé réelle d'Immo-Zen ne doit jamais être déposée dans le dépôt.
